import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  MODEL_OPTIONS,
  DEFAULT_ENABLED_MODELS,
  type ModelCategory,
  type CustomModelEntry,
} from "@open-inspect/shared";

function getModelOptionsWithCustom(): {
  modelOptions: ModelCategory[];
  defaultEnabledModels: string[];
} {
  const raw = process.env.EXTRA_MODELS;
  if (!raw) {
    return { modelOptions: MODEL_OPTIONS, defaultEnabledModels: [...DEFAULT_ENABLED_MODELS] };
  }

  let custom: CustomModelEntry[];
  try {
    custom = JSON.parse(raw);
    if (!Array.isArray(custom)) return { modelOptions: MODEL_OPTIONS, defaultEnabledModels: [...DEFAULT_ENABLED_MODELS] };
  } catch {
    return { modelOptions: MODEL_OPTIONS, defaultEnabledModels: [...DEFAULT_ENABLED_MODELS] };
  }

  const builtinIds = new Set(MODEL_OPTIONS.flatMap((g) => g.models.map((m) => m.id)));
  const extraCategories = new Map<string, ModelCategory>();
  const extraDefaults: string[] = [];

  for (const m of custom) {
    if (builtinIds.has(m.id)) continue;

    const cat = m.category ?? "Custom";
    if (!extraCategories.has(cat)) {
      extraCategories.set(cat, { category: cat, models: [] });
    }
    extraCategories.get(cat)!.models.push({
      id: m.id,
      name: m.name,
      description: m.description,
    });

    if (m.enabledByDefault) {
      extraDefaults.push(m.id);
    }
  }

  return {
    modelOptions: [...MODEL_OPTIONS, ...extraCategories.values()],
    defaultEnabledModels: [...DEFAULT_ENABLED_MODELS, ...extraDefaults],
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(getModelOptionsWithCustom());
}
