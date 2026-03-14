import { LockKeyhole, User } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { changeBetterAuthPassword } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

export default function UserAccount() {
	const { user } = useAuth();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

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
		setSuccess(null);

		if (passwordMismatch) {
			setError("New password and confirm password do not match.");
			return;
		}

		setLoading(true);

		try {
			await changeBetterAuthPassword({
				currentPassword,
				newPassword,
			});
			setSuccess("Password changed successfully.");
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
		} catch (submitError) {
			setError(
				submitError instanceof Error
					? submitError.message
					: "Unable to change password. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-xl font-semibold text-foreground">User Account</h2>
				<p className="text-sm text-muted-foreground">
					Manage your account information and credentials.
				</p>
			</div>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<LockKeyhole className="h-5 w-5" />
							Change Password
						</CardTitle>
					</CardHeader>
					<CardContent>
						<form className="space-y-4" onSubmit={handleSubmit}>
							<div className="space-y-1">
								<label htmlFor="current-password" className="text-sm font-medium">
									Current Password
								</label>
								<Input
									id="current-password"
									type="password"
									value={currentPassword}
									onChange={(event) => setCurrentPassword(event.target.value)}
									required
								/>
							</div>

							<div className="space-y-1">
								<label htmlFor="new-password" className="text-sm font-medium">
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
								<label htmlFor="confirm-password" className="text-sm font-medium">
									Confirm New Password
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

							{success && (
								<p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200">
									{success}
								</p>
							)}

							<Button
								type="submit"
								disabled={loading || passwordMismatch}
							>
								{loading ? "Saving..." : "Update Password"}
							</Button>
						</form>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<User className="h-5 w-5" />
							Current User
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3 text-sm">
						<div className="rounded-md border border-border bg-background p-3">
							<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Name
							</p>
							<p className="mt-1 font-medium text-foreground">
								{user?.name ?? "-"}
							</p>
						</div>
						<div className="rounded-md border border-border bg-background p-3">
							<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Username
							</p>
							<p className="mt-1 font-medium text-foreground">
								{user?.username || "-"}
							</p>
						</div>
						<div className="rounded-md border border-border bg-background p-3">
							<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Email
							</p>
							<p className="mt-1 break-all font-medium text-foreground">
								{user?.email ?? "-"}
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		</section>
	);
}
