import { lazy, Suspense } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";
import { AuthProvider, useAuth } from "@/providers/auth-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { RouteSkeleton } from "@/routes/route-skeleton";

const LoginPage = lazy(() => import("@/pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
	const { isAuthenticated, isLoadingSession } = useAuth();
	const location = useLocation();

	if (isLoadingSession) {
		return <RouteSkeleton />;
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	}

	return <>{children}</>;
}

function AuthAwareRoot() {
	const { isAuthenticated } = useAuth();
	return <Navigate to={isAuthenticated ? "/dashboard" : "/login"} replace />;
}

export function AppRouter() {
	return (
		<ThemeProvider>
			<AuthProvider>
				<BrowserRouter
					future={{
						v7_startTransition: true,
						v7_relativeSplatPath: true,
					}}
				>
					<Suspense fallback={<RouteSkeleton />}>
						<Routes>
							<Route path="/" element={<AuthAwareRoot />} />
							<Route path="/login" element={<LoginPage />} />
							<Route path="/forgot-password" element={<ForgotPasswordPage />} />
							<Route path="/reset-password" element={<ResetPasswordPage />} />
							<Route
								path="/dashboard"
								element={
									<ProtectedRoute>
										<DashboardPage />
									</ProtectedRoute>
								}
							/>
							<Route path="*" element={<AuthAwareRoot />} />
						</Routes>
					</Suspense>
				</BrowserRouter>
			</AuthProvider>
		</ThemeProvider>
	);
}
