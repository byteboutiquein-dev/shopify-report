import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_COOKIE_NAME, getAuthConfig } from "@/lib/auth/config";

export const metadata: Metadata = {
  title: "Login | Kuviyal Tracking"
};

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
};

function safeNextPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/";
  }

  return value;
}

async function loginAction(formData: FormData) {
  "use server";

  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const authConfig = getAuthConfig();

  if (username !== authConfig.username || password !== authConfig.password) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, authConfig.sessionSecret, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 14,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  });

  redirect(next);
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params?.next);

  return (
    <section className="login-shell">
      <div className="login-card">
        <div>
          <p className="eyebrow">Kuviyal Tracking</p>
          <h1>Login</h1>
          <p className="page-copy">Enter the app username and password to view the tracking dashboard.</p>
        </div>

        {params?.error ? (
          <div className="notice error">
            <strong>Login failed</strong>
            <p>Username or password is incorrect.</p>
          </div>
        ) : null}

        <form action={loginAction} className="login-form">
          <input name="next" type="hidden" value={next} />
          <label className="field">
            <span>User name</span>
            <input autoComplete="username" name="username" required />
          </label>
          <label className="field">
            <span>Password</span>
            <input autoComplete="current-password" name="password" required type="password" />
          </label>
          <button className="button" type="submit">Login</button>
        </form>
      </div>
    </section>
  );
}
