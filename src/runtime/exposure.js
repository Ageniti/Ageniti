export function canExposeAction(action, surface, options = {}) {
  if (!action?.supportedSurfaces.includes(surface)) {
    return false;
  }

  if (!canExposeVisibility(action, options)) {
    return false;
  }

  if (options.includeDestructive !== true && action.sideEffects === "destructive") {
    return false;
  }

  if (typeof options.filter === "function") {
    return Boolean(options.filter(action));
  }

  return true;
}

export function canExposeVisibility(action, options = {}) {
  if (action.visibility === "private") {
    return options.includePrivate === true;
  }

  if (action.visibility === "local") {
    return options.includeLocal === true;
  }

  return true;
}
