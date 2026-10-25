import type { Config } from "@netlify/functions";
import { getUser, login, signup, logout, confirmEmail, requestPasswordRecovery, recoverPassword, acceptInvite, refreshSession, verifyRequestOrigin } from "@netlify/identity";
import { readJson, send } from "./api.mjs";

export default async (req: Request) => {
  try {
    if (req.method === "GET") {
      await refreshSession();
      const user = await getUser();
      return send(200, { user: user ? { email: user.email } : null });
    }
    if (req.method !== "POST") return send(405, { error: "Method not allowed." });
    verifyRequestOrigin(req);
    const body = await readJson(req);
    switch (body.action) {
      case "login": await login(body.email, body.password); break;
      case "signup": {
        const user = await signup(body.email, body.password);
        return send(200, { message: user.confirmedAt ? "Account created. Sign in to continue." : "Check your email to confirm your account, then sign in." });
      }
      case "logout": await logout(); break;
      case "confirm": await confirmEmail(body.token); break;
      case "recover":
        await requestPasswordRecovery(body.email);
        return send(200, { message: "Check your email for a password reset link." });
      case "reset": await recoverPassword(body.token, body.password); break;
      case "invite": await acceptInvite(body.token, body.password); break;
      default: return send(400, { error: "Unknown account action." });
    }
    return send(200, { ok: true });
  } catch (error) {
    return send(error.status ?? 400, { error: error.name === "MissingIdentityError" ? "Sign-in is temporarily unavailable. Please try again shortly." : error.message || "Unable to complete the account action." });
  }
};

export const config: Config = { path: "/auth/session" };
