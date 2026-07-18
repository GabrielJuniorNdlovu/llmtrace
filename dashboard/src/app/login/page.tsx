"use client";

import { Suspense } from "react";
import { AuthForm } from "./components/auth-form";

function LoginContent(): React.ReactElement {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(157,78,221,0.35),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(245,158,11,0.2),transparent_40%),linear-gradient(160deg,#0a0a0a_0%,#1a1028_55%,#0a0a0a_100%)]" />
        <div className="relative z-10 flex w-full items-center justify-between">
          <div className="text-2xl font-bold tracking-tighter text-primary">
            lt
          </div>
          <a
            href="https://llmtrace.dev"
            className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur-sm transition-colors hover:text-white/80"
          >
            Back to website
            <span aria-hidden="true">&rarr;</span>
          </a>
        </div>
        <div className="relative z-10 mx-auto mb-10 w-full max-w-md text-center">
          <h1 className="text-balance text-4xl font-medium leading-[1.1] tracking-tight md:text-5xl">
            Secure observability for every LLM request
          </h1>
          <p className="mt-4 text-sm text-white/70">
            Trace prompts, enforce safety, and control cost — between your app
            and the model provider.
          </p>
          <div className="mt-8 flex justify-center gap-2">
            <span className="h-1 w-8 rounded-full bg-white/30" />
            <span className="h-1 w-8 rounded-full bg-white/30" />
            <span className="h-1 w-8 rounded-full bg-primary" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <div className="w-full max-w-[400px]">
          <AuthForm />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
