import { describe, expect, it } from "vitest";
import { isPushServiceEndpoint } from "@/lib/push";

describe("isPushServiceEndpoint", () => {
  it("accepte les services push des navigateurs", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ]) expect(isPushServiceEndpoint(u)).toBe(true);
  });

  it("refuse tout le reste", () => {
    for (const u of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/x",
      "https://fcm.googleapis.com.evil.com/x",
      "https://evilnotify.windows.com/x",
      "http://app:3000/api/cron/check-alerts",
      "https://169.254.169.254/latest",
      "not a url",
    ]) expect(isPushServiceEndpoint(u)).toBe(false);
  });
});
