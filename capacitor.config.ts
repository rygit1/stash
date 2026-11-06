import type { CapacitorConfig } from "@capacitor/cli";

// The Stash phone app (prototype, see MOBILE.md): a native shell around the Stash website, plus the
// native features a website can't do (lock-screen expiry reminders, and later the phone's scanner).
//
// While testing, set CAP_SERVER_URL to the site running on your Mac (e.g. http://192.168.1.142:3000)
// before `npx cap sync ios`; without it the app opens the live site.
const devUrl = process.env.CAP_SERVER_URL;

const config: CapacitorConfig = {
  appId: "pro.stashinc.app",
  appName: "Stash",
  // Only shown if the site can't be reached (see mobile/www/index.html).
  webDir: "mobile/www",
  server: devUrl ? { url: devUrl, cleartext: true } : { url: "https://stashinc.pro" },
  // Keep pages below the iPhone clock/battery bar and above the home bar instead of under them.
  ios: { contentInset: "always" },
  plugins: {
    LocalNotifications: { iconColor: "#10b981" },
  },
};

export default config;
