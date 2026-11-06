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

/**
 * A photo from the phone's camera as a JPEG data URL (at most 2200px, like the website's photos),
 * or null if the person closed the camera. Throws with the reason if the camera couldn't open, so
 * the scanner can say so instead of silently doing nothing.
 * Uses getPhoto (deprecated in this plugin version but supported) because it hands the photo back
 * as data; the newer takePhoto returns a file link this app can't read when testing from a Mac.
 */
export async function takePhotoNatively(): Promise<string | null> {
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.DataUrl,
      quality: 90,
      width: 2200,
      height: 2200,
      correctOrientation: true,
      saveToGallery: false,
    });
    return photo.dataUrl ?? null;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(reason)) return null;
    throw new Error(reason || "unknown error");
  }
}
