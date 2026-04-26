import { useState } from "react";
import { Plus, X, Pencil, Save, MoreHorizontal } from "lucide-react";
import {
  useListSavedViews,
  useCreateSavedView,
  useUpdateSavedView,
  useDeleteSavedView,
  getListSavedViewsQueryKey,
  type SavedView,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export interface ViewState {
  filters: Record<string, unknown>;
  columns: string[];
  sortBy?: string | null;
  sortDir?: "asc" | "desc" | null;
}

export interface BuiltInView {
  id: string;
  name: string;
  state: ViewState;
  isBuiltIn: true;
}

export type SavedViewEntityType =
  | "account"
  | "deal"
  | "quote"
  | "contract"
  | "signature"
  | "negotiation"
  | "obligation"
  | "renewal";

export interface SavedViewTabsProps {
  entityType: SavedViewEntityType;
  builtIns: BuiltInView[];
  activeViewId: string;
  currentState: ViewState;
  onSelect: (id: string, state: ViewState) => void;
}

function viewsAreEqual(a: ViewState, b: ViewState): boolean {
  return (
    JSON.stringify(a.filters || {}) === JSON.stringify(b.filters || {}) &&
    JSON.stringify(a.columns || []) === JSON.stringify(b.columns || []) &&
    (a.sortBy ?? null) === (b.sortBy ?? null) &&
    (a.sortDir ?? null) === (b.sortDir ?? null)
  );
}

export function SavedViewTabs({
  entityType,
  builtIns,
  activeViewId,
  currentState,
  onSelect,
}: SavedViewTabsProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: serverViews = [] } = useListSavedViews({ entityType });
  const create = useCreateSavedView();
  const update = useUpdateSavedView();
  const remove = useDeleteSavedView();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: getListSavedViewsQueryKey({ entityType }) });

  const active = [...builtIns, ...serverViews].find((v) => v.id === activeViewId);
  const activeIsServer = !!serverViews.find((v) => v.id === activeViewId);
  const activeServer = activeIsServer ? serverViews.find((v) => v.id === activeViewId) : undefined;
  const dirty = active && !activeIsServer
    ? !viewsAreEqual((active as BuiltInView).state, currentState)
    : activeServer
      ? !viewsAreEqual(toState(activeServer), currentState)
      : false;

  function toState(v: SavedView): ViewState {
    return {
      filters: (v.filters as Record<string, unknown>) ?? {},
      columns: (v.columns as string[]) ?? [],
      sortBy: v.sortBy ?? null,
      sortDir: (v.sortDir as "asc" | "desc" | null) ?? null,
    };
  }

  async function handleSaveAs() {
    if (!name.trim()) return;
    try {
      const created = await create.mutateAsync({
        data: {
          entityType,
          name: name.trim(),
          filters: currentState.filters,
          columns: currentState.columns,
          sortBy: currentState.sortBy ?? null,
          sortDir: currentState.sortDir ?? null,
        },
      });
      toast({ title: "View saved", description: created.name });
      setCreateOpen(false);
      setName("");
      await invalidate();
      onSelect(created.id, toState(created));
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function handleUpdate(id: string) {
    try {
      const updated = await update.mutateAsync({
        id,
        data: {
          filters: currentState.filters,
          columns: currentState.columns,
          sortBy: currentState.sortBy ?? null,
          sortDir: currentState.sortDir ?? null,
        },
      });
      toast({ title: "View updated", description: updated.name });
      await invalidate();
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Really delete this view?")) return;
    try {
      await remove.mutateAsync({ id });
      await invalidate();
      const fallback = builtIns[0];
      if (fallback) onSelect(fallback.id, fallback.state);
      toast({ title: "View deleted" });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="flex items-end gap-1 border-b" data-testid="saved-view-tabs">
      <div className="flex items-end gap-1 overflow-x-auto">
        {builtIns.map((v) => (
          <ViewTab
            key={v.id}
            label={v.name}
            active={v.id === activeViewId}
            onClick={() => onSelect(v.id, v.state)}
            testId={`view-tab-${v.id}`}
          />
        ))}
        {serverViews.map((v) => (
          <ViewTab
            key={v.id}
            label={v.name}
            active={v.id === activeViewId}
            onClick={() => onSelect(v.id, toState(v))}
            menu={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${v.name} Optionen`}
                    onClick={(e) => e.stopPropagation()}
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-lg hover:bg-accent/80"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => handleUpdate(v.id)} disabled={!dirty || v.id !== activeViewId}>
                    <Save className="h-3.5 w-3.5 mr-2" /> Save changes
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    const newName = prompt("New name", v.name);
                    if (newName && newName.trim()) {
                      void update.mutateAsync({ id: v.id, data: { name: newName.trim() } }).then(invalidate);
                    }
                  }}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleDelete(v.id)} className="text-destructive">
                    <X className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            testId={`view-tab-${v.id}`}
          />
        ))}
      </div>
      <div className="ml-1 flex items-center gap-1 pb-1">
        {dirty && activeIsServer && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1"
            onClick={() => activeServer && handleUpdate(activeServer.id)}
            data-testid="save-view-changes"
          >
            <Save className="h-3.5 w-3.5" /> Save changes
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs gap-1"
          onClick={() => { setName(""); setCreateOpen(true); }}
          data-testid="save-view-as"
        >
          <Plus className="h-3.5 w-3.5" /> Save view
        </Button>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save new view</DialogTitle>
            <DialogDescription>
              Saves the current filters, columns and sort order as a reusable view.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My open deals"
              maxLength={80}
              onKeyDown={(e) => { if (e.key === "Enter") void handleSaveAs(); }}
              data-testid="save-view-name-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveAs} disabled={!name.trim()} data-testid="save-view-confirm">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ViewTab({
  label,
  active,
  onClick,
  menu,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  menu?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-t-lg border border-b-0 -mb-px",
        active
          ? "border-border bg-background text-foreground font-medium"
          : "border-transparent bg-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
      data-active={active}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onClick}
        className="px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-t-lg whitespace-nowrap"
        data-testid={testId}
      >
        {label}
      </button>
      {active && menu}
    </div>
  );
}
