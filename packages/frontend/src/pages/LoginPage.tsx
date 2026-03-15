import { KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
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
import { loginWithBetterAuth } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

type LocationState = {
	from?: string;
};

export default function LoginPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { isAuthenticated, login, isLoadingSession } = useAuth();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	if (!isLoadingSession && isAuthenticated) {
		return <Navigate to="/dashboard" replace />;
	}

	const redirectTo =
		(location.state as LocationState | null)?.from ?? "/dashboard";

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setLoading(true);
		setError(null);

		const result = await loginWithBetterAuth({
			username,
			password,
		});
		if (!result.ok) {
			setError(result.message);
			setLoading(false);
			return;
		}

		const hasSession = await login();
		if (!hasSession) {
			setError(
				"Signed in but no active session was found. Check Better Auth cookie/session setup and API key env.",
			);
			setLoading(false);
			return;
		}

		navigate(redirectTo, { replace: true });
	};

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-background via-background to-secondary/30 p-4">
			<div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_20%_20%,hsl(var(--primary)/0.15),transparent_45%),radial-gradient(circle_at_80%_10%,hsl(var(--accent)/0.25),transparent_40%)]" />
			<div className="absolute right-4 top-4">
				<ThemeToggle />
			</div>
			<Card className="w-full max-w-xl animate-fade-up border-border/60 shadow-xl shadow-primary/10">
				<CardHeader>
					<div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
						<KeyRound className="h-5 w-5" />
					</div>
					<CardTitle>Sign in to HAProxy Manager</CardTitle>
					<CardDescription>
						Please sign in with your credentials.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form className="space-y-4" onSubmit={handleSubmit}>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<label className="text-sm font-medium" htmlFor="username">
									Username
								</label>
								<Input
									id="username"
									type="text"
									placeholder="Username or email"
									value={username}
									onChange={(event) => setUsername(event.target.value)}
									required
								/>
							</div>
							<div className="space-y-1">
								<label className="text-sm font-medium" htmlFor="password">
									Password
								</label>
								<Input
									id="password"
									type="password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									required
								/>
							</div>
						</div>

						{error && (
							<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
								{error}
							</p>
						)}

						<Button
							type="submit"
							className="w-full"
							disabled={loading || isLoadingSession}
						>
							{loading ? "Signing in..." : "Login"}
						</Button>
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
