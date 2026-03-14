import { BarChart3, FileCode2, LayoutDashboard, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DashboardTab =
	| "overview"
	| "stats"
	| "config"
	| "node-config"
	| "account";

type SidebarProps = {
	mobileOpen: boolean;
	onClose: () => void;
	activeTab: DashboardTab;
	onSelectTab: (tab: DashboardTab) => void;
};

const navItems = [
	{ label: "Overview", icon: LayoutDashboard, tab: "overview" as const },
	{ label: "HAProxy Stats", icon: BarChart3, tab: "stats" as const },
	{ label: "HAProxy Config", icon: FileCode2, tab: "config" as const },
	{
		label: "Node Configuration",
		icon: FileCode2,
		tab: "node-config" as const,
	},
];

export function Sidebar({
	mobileOpen,
	onClose,
	activeTab,
	onSelectTab,
}: SidebarProps) {
	return (
		<>
			<button
				type="button"
				aria-label="Close sidebar"
				className={cn(
					"fixed inset-0 z-40 bg-black/30 transition-opacity md:hidden",
					mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
				)}
				onClick={onClose}
			/>
			<aside
				className={cn(
					"fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-border bg-card/95 backdrop-blur transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-64 md:translate-x-0",
					mobileOpen ? "translate-x-0" : "-translate-x-full",
				)}
			>
				<div className="flex h-16 items-center justify-between border-b border-border px-4">
					<div>
						<p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
							HAProxy Manager
						</p>
						{/* <p className="text-sm font-semibold text-foreground">
							Operations Console
						</p> */}
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						className="md:hidden"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>

				<nav className="flex-1 p-3">
					<ul className="space-y-1">
						{navItems.map((item, index) => (
							<li
								key={item.label}
								className="animate-fade-up"
								style={{ animationDelay: `${index * 60}ms` }}
							>
								<button
									type="button"
									onClick={() => {
										onSelectTab(item.tab);
										onClose();
									}}
									className={cn(
										"flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
										activeTab === item.tab
											? "bg-primary/10 text-primary"
											: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
									)}
								>
									<item.icon className="h-4 w-4" />
									{item.label}
								</button>
							</li>
						))}
					</ul>
				</nav>

				<div className="border-t border-border p-3">
					<button
						type="button"
						onClick={() => {
							onSelectTab("account");
							onClose();
						}}
						className={cn(
							"flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
							activeTab === "account"
								? "bg-primary/10 text-primary"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
						)}
					>
						<User className="h-4 w-4" />
						User Account
					</button>
				</div>
			</aside>
		</>
	);
}
