#!/usr/bin/env python3
"""Ghost-driven balance-page scout (2026-08-23).

WHY THE GHOST AND NOT PUPPETEER: measured today on wgiftcard.com, headless puppeteer was
bounced to a Radware challenge host while the ghost walked straight through. Bot walls are the
binding constraint on this whole question, so the scout has to run in the browser that passes
the most of them, or we record our own tooling's limits as the store's policy.

WHAT IT DOES, per store: start on the gift-card page, FIND the balance link rather than trusting
a hardcoded URL (5 of 14 hardcoded URLs had already rotted in two months), follow it, then report
what is actually there. It does NOT submit. Finding the form is the open question; submitting is
the next step once we know where the forms are.

    python3 ghost-scout.py
"""
import json, subprocess, sys, tempfile, time
from pathlib import Path

GHOST = str(Path.home() / ".claude/tools/ghost")

# Start pages, not balance pages. The point is to let the site tell us where its balance check is.
STORES = {
    "starbucks": "https://www.starbucks.com/gift",
    "panera": "https://www.panerabread.com/en-us/gift-cards/balance.html",
    "walmart": "https://www.walmart.com/cp/gift-cards/1094765",
    "nordstrom": "https://www.nordstrom.com/c/gift-cards",
    "gap": "https://www.gap.com/customerService/info.do?cid=81364",
    "ulta": "https://www.ulta.com/guest/giftcard-balance",
    "homedepot": "https://www.homedepot.com/gift-cards/balance",
    "target": "https://www.target.com/guest/gift-card-balance",
}


def ghost(*args, timeout=90):
    try:
        r = subprocess.run([GHOST, *args], capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode
    except subprocess.TimeoutExpired:
        return "", 124


def run_js(expr, match, timeout=60):
    """ghost js takes a FILE holding one expression. Returns parsed JSON or a raw string."""
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as f:
        f.write(expr)
        path = f.name
    out, code = ghost("js", path, match, timeout=timeout)
    Path(path).unlink(missing_ok=True)
    if code != 0 or not out:
        return {"_error": out or f"exit {code}"}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"_raw": out[:400]}


# Dismiss consent, then report page identity + any balance link + any visible form fields.
# One expression, no awaits: ghost js is synchronous.
SURVEY = r"""
(function(){
  var clicked=[];
  var words=/^(accept all|accept|allow all|agree|i agree|got it|ok|close|continue)$/i;
  document.querySelectorAll('button,[role=button],a').forEach(function(el){
    var t=(el.innerText||el.getAttribute('aria-label')||'').trim();
    if(!words.test(t))return;
    if(!el.closest('[class*="cookie" i],[class*="consent" i],[class*="privacy" i],[id*="cookie" i],[id*="consent" i],[id*="onetrust" i]'))return;
    try{el.click();clicked.push(t);}catch(e){}
  });
  var vis=function(el){var s=getComputedStyle(el);return el.type!=='hidden'&&s.display!=='none'&&s.visibility!=='hidden'&&el.offsetParent!==null;};
  var inputs=[].slice.call(document.querySelectorAll('input')).filter(vis).map(function(el){
    return {n:el.name,id:el.id,ph:el.placeholder,t:el.type,al:el.getAttribute('aria-label')};
  });
  var links=[];
  document.querySelectorAll('a,button,[role=button]').forEach(function(el){
    var t=(el.innerText||el.getAttribute('aria-label')||'').trim();
    if(!/balance/i.test(t)||t.length>70)return;
    links.push({text:t,href:el.getAttribute('href'),tag:el.tagName.toLowerCase()});
  });
  var html=document.documentElement.outerHTML;
  return JSON.stringify({
    url:location.href,
    title:document.title,
    consent:clicked,
    inputs:inputs,
    balanceLinks:links.slice(0,8),
    // A vendor SCRIPT being present only means the site uses that CDN. Akamai is on every page of
    // every big retailer. The block is the page being REPLACED: the challenge host, a vendor name
    // in the title, or the tell-tale body copy with a reference id and no real content.
    botGuard:(/validate\.perfdrive\.com/i.test(location.href)
              || /bot manager|are you a human|let's make sure you're human|access denied|pardon our interruption/i.test(document.title + ' ' + (document.body?document.body.innerText:'').slice(0,600))),
    vendorScript:/perfdrive|shieldsquare|stormcaster|datadome|px-cloud|akam-sw|incapsula/i.test(html),
    captcha:/recaptcha\/api|hcaptcha\.com|challenges\.cloudflare/i.test(html),
    body:(document.body?document.body.innerText:'').replace(/\s+/g,' ').slice(0,300)
  });
})()
"""


def classify(s):
    """Order matters. What we FOUND outranks any wall flag, because a page that handed us a real
    balance link plainly did not block us. Getting this backwards labelled Home Depot a wall on the
    very run where it gave us its balance URL."""
    if s.get("_error"):
        return "UNREACHED (our blank)"

    # A card+PIN form means two-plus boxes that are not a search, signup or login.
    def junk(i):
        blob = " ".join(str(x) for x in [i.get("n"), i.get("id"), i.get("ph"), i.get("al")] if x).lower()
        return any(w in blob for w in ("search", "email", "zip", "query", "newsletter", "keyword",
                                       "username", "password", "signedin", "firstname", "lastname"))
    real = [i for i in s.get("inputs", []) if not junk(i)]
    if len(real) >= 2:
        return "FORM PRESENT" + (" (behind captcha)" if s.get("captcha") else "")
    if s.get("balanceLinks"):
        return "BALANCE LINK FOUND (follow it)"

    # Only now do walls and wrong-pages get to speak.
    if s.get("botGuard"):
        return "BOT-GUARDED (page replaced by a challenge)"
    title = (s.get("title") or "").lower()
    if "login" in title or "sign in" in title or any(not junk(i) and (i.get("n") or "") in ("username", "password") for i in s.get("inputs", [])):
        return "LOGIN-GATED"
    if "not found" in title or "apolog" in title or "error" in title:
        return "WRONG URL (page not found / error) -- our blank, not their wall"
    return "no form, no link on this page"


results = {}
for key, url in STORES.items():
    print(f"\n=== {key} ===", flush=True)
    ghost("open", url, timeout=90)
    time.sleep(7)
    host_match = url.split("//")[1].split("/")[0].split(".")[-2]
    s = run_js(SURVEY, host_match)
    s["startUrl"] = url
    s["verdict"] = classify(s)
    results[key] = s
    print(f"  verdict : {s['verdict']}", flush=True)
    print(f"  landed  : {s.get('title','?')}  <{s.get('url','?')}>", flush=True)
    if s.get("consent"):
        print(f"  consent : {', '.join(s['consent'])}", flush=True)
    if s.get("balanceLinks"):
        print("  links   : " + " | ".join(f"\"{l['text']}\" -> {l['href'] or l['tag']}" for l in s["balanceLinks"][:4]), flush=True)
    if s.get("inputs"):
        print("  inputs  : " + " | ".join(
            " ".join(x for x in [i.get("n"), i.get("id"), i.get("ph"), i.get("al")] if x)[:44] for i in s["inputs"][:6]), flush=True)
    if s.get("_error"):
        print(f"  error   : {s['_error'][:160]}", flush=True)

Path("evidence/ghost-scout.json").write_text(json.dumps(results, indent=2))
print("\n===== GHOST SCOUT SCOREBOARD =====")
tally = {}
for k, v in results.items():
    tally.setdefault(v["verdict"], []).append(k)
for verdict, keys in sorted(tally.items(), key=lambda x: -len(x[1])):
    print(f"  {len(keys):2}  {verdict}: {', '.join(keys)}")
