import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatsCardProps = {
	title: string;
	value: string;
	hint: string;
	state?: "ok" | "warn" | "neutral";
	compact?: boolean;
};

export function StatsCard({
	title,
	value,
	hint,
	state = "neutral",
	compact = false,
}: StatsCardProps) {
	return (
		<Card className="animate-fade-up">
			<CardHeader className={cn(compact ? "pb-1" : "pb-2")}>
				<CardTitle
					className={cn(
						"font-medium uppercase tracking-[0.12em] text-muted-foreground",
						compact ? "text-[10px]" : "text-xs",
					)}
				>
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className={cn(compact ? "pt-0 pb-3" : "pt-0")}>
				<p
					className={cn(
						"font-semibold tracking-tight text-foreground",
						compact ? "text-xl" : "text-2xl",
					)}
				>
					{value}
				</p>
				<p
					className={cn(
						compact ? "mt-1 text-[11px]" : "mt-1 text-xs",
						state === "ok" && "text-emerald-600 dark:text-emerald-400",
						state === "warn" && "text-amber-600 dark:text-amber-400",
						state === "neutral" && "text-muted-foreground",
					)}
				>
					{hint}
				</p>
			</CardContent>
		</Card>
	);
}
