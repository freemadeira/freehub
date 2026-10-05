// The React Compiler only treats `use` + a capital letter as a hook. Under the
// name `use$` it caches the call like a pure function and skips it on re-render.
export { use$ as useObservableValue } from "applesauce-react/hooks";
