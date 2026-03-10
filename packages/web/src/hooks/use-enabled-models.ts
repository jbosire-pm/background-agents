import { useMemo } from "react";
import useSWR from "swr";
import type { ModelCategory } from "@open-inspect/shared";

export const MODEL_PREFERENCES_KEY = "/api/model-preferences";
export const MODEL_OPTIONS_KEY = "/api/model-options";

interface ModelPreferencesResponse {
  enabledModels: string[];
}

interface ModelOptionsResponse {
  modelOptions: ModelCategory[];
  defaultEnabledModels: string[];
}

export function useModelOptions() {
  const { data, isLoading } = useSWR<ModelOptionsResponse>(MODEL_OPTIONS_KEY);
  return {
    modelOptions: data?.modelOptions ?? [],
    defaultEnabledModels: data?.defaultEnabledModels ?? [],
    loading: isLoading,
  };
}

export function useEnabledModels() {
  const { data, isLoading: prefsLoading } = useSWR<ModelPreferencesResponse>(MODEL_PREFERENCES_KEY);
  const { modelOptions, defaultEnabledModels, loading: optionsLoading } = useModelOptions();

  const isLoading = prefsLoading || optionsLoading;

  const enabledModels = useMemo(
    () => data?.enabledModels ?? (isLoading ? [] : defaultEnabledModels),
    [data?.enabledModels, isLoading, defaultEnabledModels],
  );

  const enabledModelOptions: ModelCategory[] = useMemo(() => {
    const enabledSet = new Set(enabledModels);
    return modelOptions
      .map((group) => ({
        ...group,
        models: group.models.filter((m) => enabledSet.has(m.id)),
      }))
      .filter((group) => group.models.length > 0);
  }, [enabledModels, modelOptions]);

  return { enabledModels, enabledModelOptions, loading: isLoading };
}
