import { DataProvider, useData } from "./data/store";
import { Auth, SetNewPassword } from "./ui/Auth";
import { Shell } from "./ui/Shell";
import { ToastProvider } from "./ui/components/kit";

function Gate() {
  const { session, authReady, recovering } = useData();
  if (!authReady) return null;
  if (recovering && session) return <SetNewPassword />;
  if (!session) return <Auth />;
  return <Shell />;
}

export default function App() {
  return (
    <ToastProvider>
      <DataProvider>
        <Gate />
      </DataProvider>
    </ToastProvider>
  );
}
