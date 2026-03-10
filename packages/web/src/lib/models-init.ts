/**
 * Server-side initialization of custom models from EXTRA_MODELS env var.
 *
 * Import this module in the root layout so custom models are registered
 * before any server component renders a model dropdown.
 */

import { loadCustomModelsFromEnv } from "@open-inspect/shared";

loadCustomModelsFromEnv();
