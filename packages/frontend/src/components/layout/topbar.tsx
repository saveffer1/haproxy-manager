import { LogOut, Menu } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";

type TopbarProps = {
	onToggleSidebar: () => void;
	onLogout: () => void | Promise<void>;
};

export function Topbar({ onToggleSidebar, onLogout }: TopbarProps) {
	return (
		<header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6">
			<div className="flex items-center gap-2">
				<Button
					variant="ghost"
					size="icon"
					onClick={onToggleSidebar}
					className="md:hidden"
				>
					<Menu className="h-5 w-5" />
				</Button>
				<div>
					<p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
						Secure Workspace
					</p>
					<h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
				</div>
			</div>
			<div className="flex items-center gap-2">
				<ThemeToggle />
				<Button variant="outline" size="sm" onClick={onLogout}>
					<LogOut className="mr-1 h-4 w-4" />
					Logout
				</Button>
			</div>
		</header>
	);
}
