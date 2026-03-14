import { ArrowLeft, LockKeyhole } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { resetPassword } from "@/lib/api";

export default function ResetPasswordPage() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const token = searchParams.get("token") ?? "";

	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);

	const passwordMismatch = useMemo(
		() =>
			newPassword.length > 0 &&
			confirmPassword.length > 0 &&
			newPassword !== confirmPassword,
		[newPassword, confirmPassword],
	);

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setError(null);
		setMessage(null);

		if (!token) {
			setError("Missing reset token in URL.");
			return;
		}

		if (passwordMismatch) {
			setError("Passwords do not match.");
			return;
		}

		setLoading(true);

		try {
			await resetPassword({
				token,
				newPassword,
			});
			setMessage("Password reset successful. Redirecting to login...");
			window.setTimeout(() => {
				navigate("/login", { replace: true });
			}, 1000);
		} catch {
			setError("Unable to reset password. Token may be invalid or expired.");
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
						<LockKeyhole className="h-5 w-5" />
					</div>
					<CardTitle>Set New Password</CardTitle>
					<CardDescription>
						Complete Better Auth password reset with token and API key.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="space-y-1">
							<label className="text-sm font-medium" htmlFor="new-password">
								New Password
							</label>
							<Input
								id="new-password"
								type="password"
								value={newPassword}
								onChange={(event) => setNewPassword(event.target.value)}
								required
							/>
						</div>

						<div className="space-y-1">
							<label className="text-sm font-medium" htmlFor="confirm-password">
								Confirm Password
							</label>
							<Input
								id="confirm-password"
								type="password"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
								required
							/>
						</div>

						{passwordMismatch && (
							<p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200">
								Passwords do not match.
							</p>
						)}

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

						<Button
							type="submit"
							className="w-full"
							disabled={loading || passwordMismatch || !token}
						>
							{loading ? "Resetting..." : "Reset Password"}
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
