if (process.env.NEXT_PUBLIC_DEPLOYMENT_ENV !== "development") {
  throw new Error("NEXT_PUBLIC_DEPLOYMENT_ENV must be development.");
}

process.env.MRC_DEPLOY_TARGET = "development";
await import("./verify-static-export.mjs");
