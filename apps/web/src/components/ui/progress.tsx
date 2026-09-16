import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

// Composant absent du dépôt shadcn installé (seuls checkbox/dialog/select…
// avaient été ajoutés) : écrit à la main sur `radix-ui` (méta-paquet déjà une
// dépendance) dans le même style que les autres primitives de ce dossier —
// `ProgressPrimitive.Root` pose déjà `role="progressbar"` et
// `aria-valuenow`/`aria-valuemax` à partir de `value`/`max`, rien à ajouter ici.
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
