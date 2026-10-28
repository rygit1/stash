// Finds which store a plastic gift card belongs to, from the text read off it on the device.
// The back of a card almost always names the store somewhere: in the fine print ("redeemable at
// The Container Store"), or as its website ("containerstore.com"). Whatever this returns is shown
// amber on the confirm screen, because text recognition can misread.

type Store = { name: string; aliases?: string[] };

// Common US gift-card brands. `aliases` are other ways the name shows up on a card: its website,
// a short form, a spelling without punctuation. The display name itself is always tried too.
const STORES: Store[] = [
  { name: "Amazon", aliases: ["amazon.com"] },
  { name: "Apple", aliases: ["apple.com/redeem", "itunes", "app store"] },
  { name: "Target", aliases: ["target.com"] },
  { name: "Walmart", aliases: ["walmart.com"] },
  { name: "Costco", aliases: ["costco.com"] },
  { name: "Sam's Club", aliases: ["samsclub"] },
  { name: "Best Buy", aliases: ["bestbuy"] },
  { name: "Home Depot", aliases: ["homedepot"] },
  { name: "Lowe's", aliases: ["lowes.com"] },
  { name: "IKEA" },
  { name: "The Container Store", aliases: ["containerstore", "container store"] },
  { name: "Bed Bath & Beyond", aliases: ["bedbathandbeyond", "bed bath"] },
  { name: "Williams Sonoma", aliases: ["williams-sonoma", "williamssonoma"] },
  { name: "Pottery Barn", aliases: ["potterybarn"] },
  { name: "Crate & Barrel", aliases: ["crateandbarrel", "crate and barrel"] },
  { name: "West Elm", aliases: ["westelm"] },
  { name: "Wayfair", aliases: ["wayfair.com"] },
  { name: "Michaels", aliases: ["michaels.com"] },
  { name: "Hobby Lobby", aliases: ["hobbylobby"] },
  { name: "Barnes & Noble", aliases: ["barnesandnoble", "barnes and noble", "barnes noble"] },
  { name: "Staples", aliases: ["staples.com"] },
  { name: "Macy's", aliases: ["macys"] },
  { name: "Nordstrom", aliases: ["nordstrom.com", "nordstrom rack"] },
  { name: "Kohl's", aliases: ["kohls"] },
  { name: "JCPenney", aliases: ["jcpenney", "jcp.com"] },
  { name: "Dillard's", aliases: ["dillards"] },
  { name: "Bloomingdale's", aliases: ["bloomingdales"] },
  { name: "Saks Fifth Avenue", aliases: ["saksfifthavenue", "saks.com"] },
  { name: "Neiman Marcus", aliases: ["neimanmarcus"] },
  { name: "TJ Maxx", aliases: ["tjmaxx", "tj maxx", "t.j. maxx"] },
  { name: "Marshalls", aliases: ["marshalls.com"] },
  { name: "HomeGoods", aliases: ["homegoods"] },
  { name: "Ross", aliases: ["rossstores", "ross dress for less"] },
  { name: "Burlington", aliases: ["burlington.com"] },
  { name: "Old Navy", aliases: ["oldnavy"] },
  { name: "Gap", aliases: ["gap.com"] },
  { name: "Banana Republic", aliases: ["bananarepublic"] },
  { name: "Athleta", aliases: ["athleta.com"] },
  { name: "American Eagle", aliases: ["americaneagle"] },
  { name: "Aerie", aliases: ["aerie.com"] },
  { name: "Abercrombie & Fitch", aliases: ["abercrombie"] },
  { name: "Hollister", aliases: ["hollisterco"] },
  { name: "Urban Outfitters", aliases: ["urbanoutfitters"] },
  { name: "Anthropologie", aliases: ["anthropologie.com"] },
  { name: "Free People", aliases: ["freepeople"] },
  { name: "H&M" },
  { name: "Zara", aliases: ["zara.com"] },
  { name: "Uniqlo", aliases: ["uniqlo.com"] },
  { name: "Forever 21", aliases: ["forever21"] },
  { name: "Lululemon", aliases: ["lululemon.com"] },
  { name: "Nike", aliases: ["nike.com"] },
  { name: "Adidas", aliases: ["adidas.com"] },
  { name: "Foot Locker", aliases: ["footlocker"] },
  { name: "Champs Sports", aliases: ["champssports"] },
  { name: "Finish Line", aliases: ["finishline"] },
  { name: "Dick's Sporting Goods", aliases: ["dickssportinggoods", "dick's sporting", "dicks sporting"] },
  { name: "REI", aliases: ["rei.com"] },
  { name: "Academy Sports", aliases: ["academy.com", "academy sports"] },
  { name: "Bass Pro Shops", aliases: ["basspro", "bass pro"] },
  { name: "Cabela's", aliases: ["cabelas"] },
  { name: "Ulta Beauty", aliases: ["ulta.com", "ulta beauty"] },
  { name: "Sephora", aliases: ["sephora.com"] },
  { name: "Bath & Body Works", aliases: ["bathandbodyworks", "bath and body works", "bath body works"] },
  { name: "Victoria's Secret", aliases: ["victoriassecret"] },
  { name: "Claire's", aliases: ["claires.com"] },
  { name: "Pandora", aliases: ["pandora.net"] },
  { name: "Kay Jewelers", aliases: ["kay.com", "kay jewelers"] },
  { name: "Zales", aliases: ["zales.com"] },
  { name: "GameStop", aliases: ["gamestop"] },
  { name: "Nintendo", aliases: ["nintendo eshop", "nintendo.com"] },
  { name: "PlayStation", aliases: ["playstation store", "playstation.com"] },
  { name: "Xbox", aliases: ["xbox.com", "microsoft store"] },
  { name: "Steam", aliases: ["steampowered", "steam wallet"] },
  { name: "Roblox", aliases: ["roblox.com"] },
  { name: "Fortnite", aliases: ["v-bucks", "vbucks"] },
  { name: "Google Play", aliases: ["play.google.com"] },
  { name: "Netflix", aliases: ["netflix.com"] },
  { name: "Spotify", aliases: ["spotify.com"] },
  { name: "Hulu", aliases: ["hulu.com"] },
  { name: "Disney", aliases: ["disneygiftcard", "disney gift card", "disney+"] },
  { name: "AMC Theatres", aliases: ["amctheatres", "amc theatres"] },
  { name: "Regal", aliases: ["regmovies", "regal cinemas"] },
  { name: "Fandango", aliases: ["fandango.com"] },
  { name: "Starbucks", aliases: ["starbucks.com"] },
  { name: "Dunkin'", aliases: ["dunkin", "dunkindonuts"] },
  { name: "Peet's Coffee", aliases: ["peets"] },
  { name: "Dutch Bros", aliases: ["dutchbros"] },
  { name: "Jamba", aliases: ["jamba juice", "jamba.com"] },
  { name: "Pinkberry", aliases: ["pinkberry.com"] },
  { name: "Krispy Kreme", aliases: ["krispykreme"] },
  { name: "Panera Bread", aliases: ["panerabread", "panera"] },
  { name: "Chipotle", aliases: ["chipotle.com"] },
  { name: "Sweetgreen", aliases: ["sweetgreen.com"] },
  { name: "Cava", aliases: ["cava.com"] },
  { name: "Shake Shack", aliases: ["shakeshack"] },
  { name: "In-N-Out Burger", aliases: ["in-n-out", "innout"] },
  { name: "Chick-fil-A", aliases: ["chick-fil-a", "chickfila"] },
  { name: "McDonald's", aliases: ["mcdonalds", "arch card"] },
  { name: "Burger King", aliases: ["burgerking"] },
  { name: "Wendy's", aliases: ["wendys"] },
  { name: "Taco Bell", aliases: ["tacobell"] },
  { name: "Subway", aliases: ["subway.com"] },
  { name: "Jersey Mike's", aliases: ["jerseymikes"] },
  { name: "Domino's", aliases: ["dominos"] },
  { name: "Pizza Hut", aliases: ["pizzahut"] },
  { name: "Papa John's", aliases: ["papajohns"] },
  { name: "Olive Garden", aliases: ["olivegarden"] },
  { name: "Darden", aliases: ["darden.com"] },
  { name: "The Cheesecake Factory", aliases: ["thecheesecakefactory", "cheesecake factory"] },
  { name: "Applebee's", aliases: ["applebees"] },
  { name: "Chili's", aliases: ["chilis"] },
  { name: "Buffalo Wild Wings", aliases: ["buffalowildwings"] },
  { name: "Texas Roadhouse", aliases: ["texasroadhouse"] },
  { name: "Outback Steakhouse", aliases: ["outback"] },
  { name: "Red Robin", aliases: ["redrobin"] },
  { name: "P.F. Chang's", aliases: ["pfchangs", "pf chang"] },
  { name: "Panda Express", aliases: ["pandaexpress"] },
  { name: "Cracker Barrel", aliases: ["crackerbarrel"] },
  { name: "IHOP", aliases: ["ihop.com"] },
  { name: "Denny's", aliases: ["dennys"] },
  { name: "Dave & Buster's", aliases: ["daveandbusters", "dave and busters", "dave & busters"] },
  { name: "Whole Foods", aliases: ["wholefoods"] },
  { name: "Trader Joe's", aliases: ["traderjoes"] },
  { name: "Kroger", aliases: ["kroger.com"] },
  { name: "Safeway", aliases: ["safeway.com"] },
  { name: "Ralphs", aliases: ["ralphs.com"] },
  { name: "Vons", aliases: ["vons.com"] },
  { name: "Albertsons", aliases: ["albertsons.com"] },
  { name: "Publix", aliases: ["publix.com"] },
  { name: "Sprouts", aliases: ["sprouts.com", "sprouts farmers market"] },
  { name: "CVS", aliases: ["cvs.com", "cvs pharmacy"] },
  { name: "Walgreens", aliases: ["walgreens.com"] },
  { name: "PetSmart", aliases: ["petsmart"] },
  { name: "Petco", aliases: ["petco.com"] },
  { name: "Chewy", aliases: ["chewy.com"] },
  { name: "DoorDash", aliases: ["doordash"] },
  { name: "Uber", aliases: ["uber eats", "ubereats", "uber.com"] },
  { name: "Lyft", aliases: ["lyft.com"] },
  { name: "Grubhub", aliases: ["grubhub.com"] },
  { name: "Instacart", aliases: ["instacart.com"] },
  { name: "Airbnb", aliases: ["airbnb.com"] },
  { name: "Southwest Airlines", aliases: ["southwest.com"] },
  { name: "Delta", aliases: ["delta.com"] },
  { name: "Marriott", aliases: ["marriott.com"] },
  { name: "Hilton", aliases: ["hilton.com"] },
  { name: "eBay", aliases: ["ebay.com"] },
  { name: "Etsy", aliases: ["etsy.com"] },
  { name: "Shell", aliases: ["shell.us", "shell gift card"] },
  { name: "Chevron", aliases: ["chevron.com"] },
  { name: "Exxon Mobil", aliases: ["exxon", "exxonmobil"] },
  { name: "Visa Gift Card", aliases: ["vanilla visa", "visa gift", "visa prepaid"] },
  { name: "Mastercard Gift Card", aliases: ["vanilla mastercard", "mastercard gift", "mastercard prepaid"] },
  { name: "American Express Gift Card", aliases: ["american express gift", "amex gift"] },
];

// Brand names that are also everyday words in card fine print: only accept them when they're not
// just part of a payment method ("add to Apple Pay") or a generic phrase.
const NOT_THE_STORE = /\b(?:apple|google|samsung|amazon)\s*(?:pay|wallet)\b/g;

// Websites printed on cards that belong to card processors or balance services, not the store.
const GENERIC_SITES = new Set([
  "giftcards", "giftcard", "giftcardmall", "mygiftcardsite", "mybalancenow", "balancenow", "checkbalance",
  "cardbalance", "giftcardbalance", "blackhawk", "blackhawknetwork", "incomm", "givex", "valuelink",
  "svsgiftcard", "svs", "fiserv", "vanillagift", "onevanilla", "prepaid", "cashstar", "wgiftcard",
  "example", "google", "apple", "facebook", "instagram", "twitter", "tiktok", "youtube",
]);

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Precomputed once: each store's spellings, both as a squashed string (catches websites and OCR that
// drops spaces or punctuation) and as a word-boundary pattern for short names like "Gap" or "REI".
const MATCHERS = STORES.map((s) => ({
  name: s.name,
  forms: [s.name, ...(s.aliases ?? [])].map((a) => {
    const sq = squash(a.replace(/\.(com|net|us)\b.*$/, ""));
    const words = a
      .toLowerCase()
      .replace(/\.(com|net|us)\b.*$/, "")
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map(escapeRe);
    return { sq, re: new RegExp(`\\b${words.join("[^a-z0-9]{0,3}")}\\b`, "g") };
  }),
}));

/** The store a gift card's text names, or null. Picks the store mentioned most often (a card can
 *  list sister brands in its fine print), then the most specific (longest) name on a tie. */
export function findStoreName(text: string): string | null {
  const lower = text.toLowerCase().replace(NOT_THE_STORE, " ");
  const squashed = squash(lower);
  let best: { name: string; hits: number; len: number } | null = null;
  for (const m of MATCHERS) {
    // A store's spellings overlap ("Old Navy" and "oldnavy.com"), so take its best-matching form rather
    // than adding them up, which would favour stores with more aliases.
    let hits = 0;
    let len = 0;
    for (const f of m.forms) {
      // Long names are safe to find inside squashed text; short ones need whole words.
      const n = f.sq.length >= 7 ? squashed.split(f.sq).length - 1 : (lower.match(f.re) ?? []).length;
      if (n > hits || (n === hits && n > 0 && f.sq.length > len)) {
        hits = n;
        len = f.sq.length;
      }
    }
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && len > best.len))) best = { name: m.name, hits, len };
  }
  if (best) return best.name;

  // Not a store we know: fall back to a website printed on the card, e.g. "shopacme.com" → "Shopacme".
  for (const [, site] of lower.matchAll(/\b(?:www\.)?([a-z][a-z0-9-]{3,30})\.(?:com|net|us)\b/g)) {
    const stem = site.replace(/-/g, "");
    if (GENERIC_SITES.has(stem) || [...GENERIC_SITES].some((g) => g.length >= 6 && stem.includes(g))) continue;
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }
  return null;
}
