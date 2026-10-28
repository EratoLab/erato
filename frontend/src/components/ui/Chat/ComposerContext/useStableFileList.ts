import { useRef } from "react";

/**
 * The previous array while every element is the same file. The token
 * estimate keys a query on its input, so a fresh but equal array on each
 * keystroke would refetch it.
 */
export const useStableFileList = (files: File[]): File[] => {
  const ref = useRef(files);
  const previous = ref.current;
  if (
    previous !== files &&
    (previous.length !== files.length ||
      previous.some((file, index) => file !== files[index]))
  ) {
    ref.current = files;
  }
  return ref.current;
};
