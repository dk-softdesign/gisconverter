import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { setUserDataFn } from "#/lib/auth-functions";
import { authQueryOptions } from "#/lib/auth-query";
import type { AuthState, JsonValue, PreloadedUserData } from "#/lib/auth-types";

type PreloadedKey = keyof PreloadedUserData;

// The signed-in member's settings/presets, as loaded with the page. Signed
// out (login pages) there are none, and consumers fall back to defaults.
export function useUserData(key: PreloadedKey): JsonValue {
  const { data } = useQuery(authQueryOptions());
  return data?.userData[key] ?? null;
}

// Updates a preloaded value: the UI changes at once, the server copy right
// after. Signed out, the change only lasts for this page.
export function useSetUserData() {
  const queryClient = useQueryClient();
  return useCallback(
    (key: PreloadedKey, update: (previous: JsonValue) => JsonValue) => {
      const queryKey = authQueryOptions().queryKey;
      const state = queryClient.getQueryData<AuthState>(queryKey);
      if (!state) return;
      const value = update(state.userData[key]);
      queryClient.setQueryData<AuthState>(queryKey, {
        ...state,
        userData: { ...state.userData, [key]: value },
      });
      if (!state.user) return;
      setUserDataFn({ data: { key, value } })
        .then((result) => {
          if (!result.ok) toast.error(`Couldn't save: ${result.error}`);
        })
        .catch(() => toast.error("Couldn't save your change — check your connection."));
    },
    [queryClient],
  );
}
