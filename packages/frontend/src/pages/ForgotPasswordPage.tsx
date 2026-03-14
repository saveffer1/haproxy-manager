import { ArrowLeft, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/api";

export default function ForgotPasswordPage() {
	const [identity, setIdentity] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLoading(true);
		setError(null);
		setMessage(null);

		try {
			await requestPasswordReset({
				identity,
				redirectTo: `${window.location.origin}/reset-password`,
			});
			setMessage("If the account exists, a reset link has been sent.");
		} catch {
			setError("Unable to request password reset. Please check identity.");
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-background via-background to-secondary/30 p-4">
			<div className="absolute right-4 top-4">
				<ThemeToggle />
			</div>
			<Card className="w-full max-w-md border-border/60 shadow-xl shadow-primary/10">
				<CardHeader>
					<div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
						<Mail className="h-5 w-5" />
					</div>
					<CardTitle>Reset Password</CardTitle>
					<CardDescription>
						Request a Better Auth reset link using username or email.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-1">
							<label className="text-sm font-medium" htmlFor="identity">
								Username or Email
							</label>
							<Input
								id="identity"
								type="text"
								value={identity}
								onChange={(event) => setIdentity(event.target.value)}
								required
							/>
						</div>

						{error && (
							<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
								{error}
							</p>
						)}

						{message && (
							<p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
								{message}
							</p>
						)}

						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? "Requesting..." : "Send Reset Link"}
						</Button>

						<Link
							to="/login"
							className="inline-flex items-center gap-2 text-sm text-primary hover:text-primary/80"
						>
							<ArrowLeft className="h-4 w-4" />
							Back to Login
						</Link>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
