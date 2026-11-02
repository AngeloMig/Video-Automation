import { redirect } from "next/navigation";
import { authMode, getSession } from "@/lib/auth";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/overview");
  return <AuthForm mode="login" localAuth={authMode() === "local"} />;
}
