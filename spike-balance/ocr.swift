// Local text reading with Apple's Vision framework. No API, no key, no network, no model download.
// Built 2026-08-23 to answer: can we read a gift card's digits on-device instead of paying an API?
//
//   swiftc -O ocr.swift -o ocr   (once)
//   ./ocr <image> [--fast]
//
// Prints JSON: every text line it found with a confidence, plus any run of >=8 digits, which is
// what a gift card number looks like. Accuracy is the whole point here, so it defaults to the
// .accurate path and asks for language correction OFF (card numbers are not words, and correction
// happily turns a digit into a letter).

import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: ocr <image> [--fast]\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
let fast = args.contains("--fast")

guard let image = NSImage(contentsOfFile: path),
      let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("{\"error\":\"could not open image\"}")
    exit(1)
}

let started = Date()
let request = VNRecognizeTextRequest()
request.recognitionLevel = fast ? .fast : .accurate
// Card numbers are not dictionary words. Correction "helpfully" rewrites digits into letters,
// which is the single worst failure mode for this job, so it stays off.
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
    try handler.perform([request])
} catch {
    print("{\"error\":\"vision failed: \(error)\"}")
    exit(1)
}

var lines: [[String: Any]] = []
var joined = ""
for obs in (request.results ?? []) {
    guard let top = obs.topCandidates(1).first else { continue }
    lines.append(["text": top.string, "confidence": Double(top.confidence)])
    joined += top.string + "\n"
}

// Any run of 8+ digits (spaces and dashes allowed inside) is a gift-card-number shape.
var digitRuns: [String] = []
if let re = try? NSRegularExpression(pattern: "[0-9][0-9 -]{6,}[0-9]") {
    let ns = joined as NSString
    for m in re.matches(in: joined, range: NSRange(location: 0, length: ns.length)) {
        let raw = ns.substring(with: m.range)
        if raw.filter({ $0.isNumber }).count >= 8 { digitRuns.append(raw.trimmingCharacters(in: .whitespaces)) }
    }
}

let out: [String: Any] = [
    "ms": Int(Date().timeIntervalSince(started) * 1000),
    "level": fast ? "fast" : "accurate",
    "lineCount": lines.count,
    "lines": lines,
    "digitRuns": digitRuns,
]
let data = try! JSONSerialization.data(withJSONObject: out, options: [.prettyPrinted])
print(String(data: data, encoding: .utf8)!)
