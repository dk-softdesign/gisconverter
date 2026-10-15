// Built-in Custom JS snippets offered in the bulk edit dialog alongside the
// user's own saved scripts. Same contract as a user script: a function body
// that receives `props` and `feature` and returns the new properties object.
export const PREDEFINED_SCRIPTS: Record<string, string> = {
  // Renames the `id` property to `fid`, leaving features without one untouched.
  renamePropKey: `if (!props || !Object.prototype.hasOwnProperty.call(props, "id")) {
  return { ...props };
}

const { id, ...rest } = props;
return { ...rest, fid: id };`,
};
