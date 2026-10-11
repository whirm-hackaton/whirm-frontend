<script lang="ts" module>
	import { type VariantProps, tv } from "tailwind-variants";
	import { cn, type WithElementRef } from "$lib/utils.js";
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

	export const buttonVariants = tv({
		base: "aria-invalid:border-destructive rounded-md border border-transparent bg-clip-padding font-semibold [&_svg:not([class*='size-'])]:size-4 group/button inline-flex max-w-full shrink-0 items-center justify-center whitespace-normal text-center transition-colors duration-150 select-none disabled:pointer-events-none disabled:bg-disabled-surface disabled:text-disabled-text disabled:border-border aria-disabled:pointer-events-none aria-disabled:bg-disabled-surface aria-disabled:text-disabled-text [&_svg]:pointer-events-none [&_svg]:shrink-0",
		variants: {
			variant: {
				default: "bg-primary text-primary-foreground hover:bg-primary-hover",
				outline: "border-input bg-background text-foreground hover:bg-muted",
				secondary: "bg-secondary text-secondary-foreground hover:bg-muted",
				ghost: "hover:bg-muted hover:text-foreground",
				destructive: "bg-destructive/10 text-destructive hover:bg-destructive/15",
				link: "text-primary underline underline-offset-3 hover:text-primary-hover",
			},
			size: {
				default: "min-h-12 gap-2 px-4 py-3 text-base leading-6",
				xs: "min-h-11 gap-2 px-3 py-2 text-sm",
				sm: "min-h-11 gap-2 px-3 py-2 text-sm",
				lg: "min-h-12 gap-2 px-4 py-3 text-base leading-6",
				icon: "size-11",
				"icon-xs": "size-11",
				"icon-sm": "size-11",
				"icon-lg": "size-12",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>["variant"];
	export type ButtonSize = VariantProps<typeof buttonVariants>["size"];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = "default",
		size = "default",
		ref = $bindable(null),
		href = undefined,
		type = "button",
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? "link" : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
