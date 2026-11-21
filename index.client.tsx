import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { TasksScreen } from "./client/tasks";

function TasksItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow icon="List" active={currentScreen?.screenId === "tasks-handoffs"} onPress={() => openScreen({ screenId: "tasks-handoffs" })} />;
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "tasks-handoffs", title: "Tasks & Handoffs", Component: TasksScreen });
  client.addSidebarHeaderItem({ id: "tasks-handoffs", title: "Tasks & Handoffs", Component: TasksItem });
  return () => {};
}
