// The prebuilt browser bundle has no types of its own; it has the same shape as the main package.
declare module "exceljs/dist/exceljs.min.js" {
  import ExcelJS from "exceljs";
  export default ExcelJS;
}
