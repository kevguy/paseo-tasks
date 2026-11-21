import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listRpc, detailRpc, artifactRpc } from "./shared/tasks";
import { getList, getDetail, getArtifact } from "./server/store";
export default function contribute(server: PluginServerContext) {
  server.handle(listRpc, ({ filter, search }) => getList(filter, search));
  server.handle(detailRpc, ({ id }) => getDetail(id));
  server.handle(artifactRpc, ({ id, referenceId }) => getArtifact(id, referenceId));
  return () => {};
}
