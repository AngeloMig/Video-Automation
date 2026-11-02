import { redirect } from "next/navigation";
import { authMode, getSession } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create account" };

export default async function SignupPage() {
  if (await getSession()) redirect("/overview");
  return <AuthForm mode="signup" localAuth={authMode() === "local"} />;
}
