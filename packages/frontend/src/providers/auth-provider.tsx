import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { getBetterAuthSession, signOutBetterAuth } from "@/lib/api";

type SessionUser = {
	id: string;
	email: string;
	name: string;
	username?: string | null;
};

type AuthContextValue = {
	user: SessionUser | null;
	isAuthenticated: boolean;
	isLoadingSession: boolean;
	login: () => Promise<boolean>;
	logout: () => Promise<void>;
	refreshSession: () => Promise<boolean>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: PropsWithChildren) {
	const [user, setUser] = useState<SessionUser | null>(null);
	const [isLoadingSession, setIsLoadingSession] = useState(true);

	const refreshSession = useCallback(async () => {
		setIsLoadingSession(true);
		const session = await getBetterAuthSession();
		setUser(session?.user ?? null);
		setIsLoadingSession(false);
		return Boolean(session?.user);
	}, []);

	useEffect(() => {
		void refreshSession();
	}, [refreshSession]);

	const login = useCallback(async () => {
		return refreshSession();
	}, [refreshSession]);

	const logout = useCallback(async () => {
		try {
			await signOutBetterAuth();
		} catch {
			// Ignore logout API errors; local auth state should still clear.
		}

		setUser(null);
	}, []);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isAuthenticated: Boolean(user),
			isLoadingSession,
			login,
			logout,
			refreshSession,
		}),
		[user, isLoadingSession, login, logout, refreshSession],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within AuthProvider");
	}
	return context;
}
