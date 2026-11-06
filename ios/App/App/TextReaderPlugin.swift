import Capacitor
import UIKit
import Vision

// Reads a card photo with the iPhone's own recognition (Apple's Vision framework, the same engine as
// Live Text): the printed text and every barcode, from one photo. Much more accurate on shiny cards and tiny print than the
// text reader the website uses. Runs entirely on the phone: the photo is never uploaded.
// Called from lib/cardOcr.ts as the "TextReader" plugin.
@objc(TextReaderPlugin)
public class TextReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextReaderPlugin"
    public let jsName = "TextReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    /// image: a JPEG/PNG data URL or plain base64. Resolves { text, barcodes }: the lines read top to
    /// bottom, and each barcode / QR code found ({ value, type }).
    @objc func read(_ call: CAPPluginCall) {
        guard var base64 = call.getString("image") else {
            call.reject("No image given")
            return
        }
        if base64.hasPrefix("data:"), let comma = base64.firstIndex(of: ",") {
            base64 = String(base64[base64.index(after: comma)...])
        }
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            call.reject("Couldn't open the photo")
            return
        }

        // One pass over the photo finds both the printed text and every barcode / QR code in it.
        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .accurate
        textRequest.usesLanguageCorrection = false // card numbers and codes aren't words
        let barcodeRequest = VNDetectBarcodesRequest()

        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: Self.orientation(of: image), options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([textRequest, barcodeRequest])
            } catch {
                call.reject(error.localizedDescription)
                return
            }
            // Vision measures from the bottom of the image, so a higher minY is higher on the card.
            let lines = (textRequest.results ?? [])
                .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
                .compactMap { $0.topCandidates(1).first?.string }
            var seen = Set<String>()
            var barcodes: [JSObject] = []
            for observation in barcodeRequest.results ?? [] {
                guard let payload = observation.payloadStringValue, !payload.isEmpty, !seen.contains(payload) else { continue }
                seen.insert(payload)
                barcodes.append(["value": payload, "type": observation.symbology.rawValue])
            }
            call.resolve(["text": lines.joined(separator: "\n"), "barcodes": barcodes])
        }
    }

    private static func orientation(of image: UIImage) -> CGImagePropertyOrientation {
        switch image.imageOrientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}

// The app's main screen: Capacitor's, plus Stash's own TextReader plugin.
class StashViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextReaderPlugin())
    }
}
