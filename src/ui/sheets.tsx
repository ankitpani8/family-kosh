// One place that opens edit sheets, so any screen can say "edit this holding" without owning the modal.
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Goal, Holding, Person } from "../engine";
import { GoalForm, HoldingForm, PersonForm, PriceForm, UpdateForm } from "./forms";

type Sheet =
  | { kind: "holding"; holding?: Holding }
  | { kind: "update"; holding: Holding }
  | { kind: "price"; seriesId?: string }
  | { kind: "person"; person?: Person }
  | { kind: "goal"; goal?: Goal; ownerId?: string };

const Ctx = createContext<(s: Sheet) => void>(() => {});
export const useSheet = () => useContext(Ctx);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Sheet | null>(null);
  const close = () => setS(null);
  return (
    <Ctx.Provider value={setS}>
      {children}
      {s?.kind === "holding" && <HoldingForm holding={s.holding} onClose={close} />}
      {s?.kind === "update" && <UpdateForm holding={s.holding} onClose={close} onPrice={(id) => setS({ kind: "price", seriesId: id })} />}
      {s?.kind === "price" && <PriceForm seriesId={s.seriesId} onClose={close} />}
      {s?.kind === "person" && <PersonForm person={s.person} onClose={close} />}
      {s?.kind === "goal" && <GoalForm goal={s.goal} ownerId={s.ownerId} onClose={close} />}
    </Ctx.Provider>
  );
}
