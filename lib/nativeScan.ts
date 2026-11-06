// Native barcode scanner for the phone app (see MOBILE.md). Opens the phone's own full-screen
// scanner, which reads the barcode live from the camera: faster and more reliable than reading
// it out of a photo. Everything happens on the phone; nothing is uploaded.
//
// The website never uses this: nativeScanAvailable() is false in a browser, and the plugin is
// loaded only when a scan actually starts, so it isn't part of the website's code.

import { Capacitor } from "@capacitor/core";

export function nativeScanAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** The barcode's contents, or null if the person closed the scanner without scanning one. */
export async function scanBarcodeNatively(): Promise<string | null> {
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } = await import("@capacitor/barcode-scanner");
  try {
    const result = await CapacitorBarcodeScanner.scanBarcode({
      hint: CapacitorBarcodeScannerTypeHint.ALL,
      scanInstructions: "Point at the barcode on your gift card",
      scanButton: false,
      cancelButtonAccessibilityLabel: "Cancel",
      torchButtonOnAccessibilityLabel: "Turn off the light",
      torchButtonOffAccessibilityLabel: "Turn on the light",
    });
    const code = result.ScanResult?.trim();
    return code ? code : null;
  } catch {
    return null; // closed / cancelled
  }
}
