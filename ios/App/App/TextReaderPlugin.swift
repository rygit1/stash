import Capacitor
import UIKit
import Vision

// Reads the printed text on a card photo with the iPhone's own text recognition (Apple's Vision
// framework, the same engine as Live Text). Much more accurate on shiny cards and tiny print than the
// text reader the website uses. Runs entirely on the phone: the photo is never uploaded.
// Called from lib/cardOcr.ts as the "TextReader" plugin.
@objc(TextReaderPlugin)
public class TextReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TextReaderPlugin"
    public let jsName = "TextReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    /// image: a JPEG/PNG data URL or plain base64. Resolves { text }: the lines read, top to bottom.
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

        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                call.reject(error.localizedDescription)
                return
            }
            let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
            // Vision measures from the bottom of the image, so a higher minY is higher on the card.
            let lines = observations
                .sorted { $0.boundingBox.minY > $1.boundingBox.minY }
                .compactMap { $0.topCandidates(1).first?.string }
            call.resolve(["text": lines.joined(separator: "\n")])
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false // card numbers and codes aren't words

        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: Self.orientation(of: image), options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try handler.perform([request])
            } catch {
                call.reject(error.localizedDescription)
            }
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
