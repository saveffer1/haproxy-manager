import { Skeleton } from "@/components/ui/skeleton";

export function RouteSkeleton() {
	return (
		<div className="flex min-h-screen items-center justify-center bg-background p-4">
			<div className="w-full max-w-lg space-y-4 rounded-xl border bg-card p-6 shadow-sm">
				<Skeleton className="h-6 w-40" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-28" />
			</div>
		</div>
	);
}
