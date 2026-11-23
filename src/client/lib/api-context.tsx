import { createContext, useContext, type ReactNode } from "react";
import { api as serverApi } from "./api";

/** The API surface the UI uses. The server implementation and the in-browser demo both satisfy it. */
export type Api = typeof serverApi;

export interface AppPaths {
  home: string;
  account: (id: string) => string;
}

interface ApiContextValue {
  api: Api;
  paths: AppPaths;
}

const defaultValue: ApiContextValue = {
  api: serverApi,
  paths: { home: "/app", account: (id) => `/app/accounts/${id}` },
};

const ApiContext = createContext<ApiContextValue>(defaultValue);

export function ApiProvider({ api, paths, children }: ApiContextValue & { children: ReactNode }) {
  return <ApiContext.Provider value={{ api, paths }}>{children}</ApiContext.Provider>;
}

export const useApi = () => useContext(ApiContext).api;
export const usePaths = () => useContext(ApiContext).paths;
