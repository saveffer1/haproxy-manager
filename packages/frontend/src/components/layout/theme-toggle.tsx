import { Moon, SunMedium } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/providers/theme-provider";

export function ThemeToggle() {
	const { theme, toggleTheme } = useTheme();

	return (
		<Button
			variant="outline"
			size="icon"
			onClick={toggleTheme}
			aria-label="Toggle color theme"
			title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
		>
			{theme === "dark" ? (
				<SunMedium className="h-4 w-4" />
			) : (
				<Moon className="h-4 w-4" />
			)}
		</Button>
	);
}
