import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type Theme = "light" | "dark";

type ThemeContextValue = {
	theme: Theme;
	toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);
const THEME_STORAGE_KEY = "haproxy_manager_theme";

function getInitialTheme(): Theme {
	if (typeof window === "undefined") {
		return "light";
	}

	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === "dark" || stored === "light") {
		return stored;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function ThemeProvider({ children }: PropsWithChildren) {
	const [theme, setTheme] = useState<Theme>(getInitialTheme);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		window.localStorage.setItem(THEME_STORAGE_KEY, theme);
	}, [theme]);

	const value = useMemo(
		() => ({
			theme,
			toggleTheme: () =>
				setTheme((prev) => (prev === "dark" ? "light" : "dark")),
		}),
		[theme],
	);

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within ThemeProvider");
	}
	return context;
}
