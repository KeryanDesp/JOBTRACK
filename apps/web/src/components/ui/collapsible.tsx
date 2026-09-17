"use client"

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

// Composant absent du dépôt shadcn installé (comme `progress.tsx`) : écrit à
// la main sur `radix-ui` (méta-paquet déjà une dépendance) dans le même style
// que les autres primitives de ce dossier — `CollapsiblePrimitive.Trigger`
// pose déjà `aria-expanded`/`aria-controls`/`data-state` à partir de l'état
// ouvert/fermé, rien à ajouter ici.
function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
