import { useEffect, useState } from "react";
import { BackgroundDots } from "./components/BackgroundDots";
import { TOOLS, getTool } from "./tools/registry";
import type { ToolDef } from "./tools/registry";
import { APP_VERSION } from "./version";

const WORKSPACE_NAME = "Abyrx Tools";

function idFromHash(): string | null {
	const id = window.location.hash.replace(/^#\/?/, "");
	return getTool(id)?.status === "active" ? id : null;
}

function SidebarItem({
	tool,
	active,
	onSelect,
}: {
	tool: ToolDef;
	active: boolean;
	onSelect: (id: string) => void;
}) {
	const disabled = tool.status !== "active";
	return (
		<button
			onClick={() => !disabled && onSelect(tool.id)}
			disabled={disabled}
			className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
				active
					? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
					: disabled
						? "cursor-default text-neutral-400 dark:text-neutral-600"
						: "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
			}`}
		>
			<span className="text-base leading-none">{tool.icon}</span>
			<span className="flex-1 truncate font-medium">{tool.name}</span>
			{disabled && (
				<span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-500 dark:bg-neutral-800">
					soon
				</span>
			)}
		</button>
	);
}

function Dashboard({ onSelect }: { onSelect: (id: string) => void }) {
	return (
		<div className="mx-auto w-full max-w-4xl">
			<h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
				Your tools
			</h2>
			<p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
				Pick a tool to get started.
			</p>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				{TOOLS.map((tool) => {
					const disabled = tool.status !== "active";
					return (
						<button
							key={tool.id}
							onClick={() => !disabled && onSelect(tool.id)}
							disabled={disabled}
							className={`flex flex-col items-start gap-2 rounded-2xl border p-5 text-left transition-all ${
								disabled
									? "cursor-default border-dashed border-neutral-200 bg-transparent dark:border-neutral-800"
									: "border-neutral-200 bg-white/80 shadow-sm hover:-translate-y-0.5 hover:shadow-md dark:border-neutral-800 dark:bg-neutral-900/70"
							}`}
						>
							<span className="text-2xl">{tool.icon}</span>
							<span className="font-semibold text-neutral-800 dark:text-neutral-100">
								{tool.name}
							</span>
							<span className="text-sm text-neutral-500 dark:text-neutral-400">
								{tool.tagline}
							</span>
							{disabled && (
								<span className="mt-1 rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-400 dark:bg-neutral-800">
									Coming soon
								</span>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
}

function App() {
	const [activeId, setActiveId] = useState<string | null>(idFromHash);
	const active = getTool(activeId);
	const ActiveTool = active?.component;

	// Keep the URL hash in sync so tools are bookmarkable / shareable.
	useEffect(() => {
		const target = activeId ? `#/${activeId}` : "#/";
		if (window.location.hash !== target) window.location.hash = target;
	}, [activeId]);

	useEffect(() => {
		const onHash = () => setActiveId(idFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);

	return (
		<div className="relative flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
			<div className="pointer-events-none absolute inset-0 overflow-hidden text-neutral-200/50 dark:text-neutral-700/40">
				<BackgroundDots />
			</div>

			{/* Sidebar */}
			<aside className="relative z-10 hidden w-60 shrink-0 flex-col border-r border-neutral-200 bg-white/70 px-4 py-6 backdrop-blur md:flex dark:border-neutral-800 dark:bg-neutral-900/50">
				<button
					onClick={() => setActiveId(null)}
					className="mb-6 flex items-center gap-2 px-1 text-left"
				>
					<span className="text-lg">🛠️</span>
					<span className="font-semibold text-neutral-800 dark:text-neutral-100">
						{WORKSPACE_NAME}
					</span>
				</button>
				<nav className="space-y-1">
					<button
						onClick={() => setActiveId(null)}
						className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
							activeId === null
								? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
								: "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
						}`}
					>
						<span className="text-base leading-none">🏠</span>
						<span className="flex-1">Home</span>
					</button>
					{TOOLS.map((tool) => (
						<SidebarItem
							key={tool.id}
							tool={tool}
							active={tool.id === activeId}
							onSelect={setActiveId}
						/>
					))}
				</nav>
				<div className="mt-auto px-1 pt-6 text-[11px] text-neutral-400 dark:text-neutral-600">
					{APP_VERSION}
				</div>
			</aside>

			{/* Main */}
			<div className="relative z-10 flex min-w-0 flex-1 flex-col">
				{/* Mobile top bar */}
				<header className="flex items-center justify-between border-b border-neutral-200 px-6 py-4 md:hidden dark:border-neutral-800">
					<button onClick={() => setActiveId(null)} className="flex items-center gap-2">
						<span className="text-lg">🛠️</span>
						<span className="font-semibold text-neutral-800 dark:text-neutral-100">
							{WORKSPACE_NAME}
						</span>
					</button>
					{active && (
						<button
							onClick={() => setActiveId(null)}
							className="text-sm font-medium text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
						>
							← Tools
						</button>
					)}
				</header>

				<main className="flex-1 overflow-y-auto px-6 py-8">
					{active && ActiveTool ? (
						<>
							<button
								onClick={() => setActiveId(null)}
								className="mb-4 hidden text-sm font-medium text-neutral-400 hover:text-neutral-700 md:inline-block dark:hover:text-neutral-200"
							>
								← All tools
							</button>
							<ActiveTool />
						</>
					) : (
						<Dashboard onSelect={setActiveId} />
					)}
				</main>
			</div>
		</div>
	);
}

export default App;
