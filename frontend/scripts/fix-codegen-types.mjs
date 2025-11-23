import fs from "fs/promises";
import path from "path";

const targetDir = path.resolve(process.cwd(), "src/lib/generated/v1betaApi");

// --- Patch for ?: void; types ---
const voidPattern = /\?: void;/g;
const voidReplacement = "?: null | undefined;";

// --- JSDoc insertion for fetchUploadFile ---
const componentsFile = path.join(targetDir, "v1betaApiComponents.ts");
const fetchUploadFileMarker = "export const fetchUploadFile = (";
const fetchUploadFileJSDoc = `
/**
 * WORKAROUND: This endpoint requires a multipart/form-data request.
 * Despite the type signature suggesting \`body?: Schemas.MultipartFormFile[]\`, 
 * the underlying fetcher expects a pre-constructed \`FormData\` object.
 * 
 * When calling this function, construct a \`FormData\` object manually,
 * append your file(s) to it (e.g., \`formData.append('file', myFile)\`),\n * and pass it as the \`body\` property in the \`variables\` object, using type casting:
 * 
 * \`\`\`ts
 * const formData = new FormData();
 * formData.append('file', myFile);
 * const variables = {\n *   queryParams: { chat_id: '...' },\n *   body: formData as unknown, // Cast needed to bypass type mismatch\n *   headers: { 'Content-Type': 'multipart/form-data' } // Header hint might be needed\n * };
 * const response = await fetchUploadFile(variables as UploadFileVariables);\n * \`\`\`
 */
`;

// --- Fix deepMerge function in v1betaApiUtils.ts ---
const utilsFile = path.join(targetDir, "v1betaApiUtils.ts");
const deepMergeBugPattern =
  /Object\.assign\(source\[key\], deepMerge\(\(target as any\)\[key\], source\[key\]\)\);/g;
const deepMergeFix = `Object.assign(source[key], deepMerge((target && (target as any)[key]) || {}, source[key]));`;

async function patchVoidTypes(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const relativeFilePath = path.relative(process.cwd(), filePath);

    if (voidPattern.test(content)) {
      console.log(`Found void types in: ${relativeFilePath}`);
      const newContent = content.replace(voidPattern, voidReplacement);
      if (newContent !== content) {
        await fs.writeFile(filePath, newContent, "utf8");
        console.log(`Patched void types in: ${relativeFilePath}`);
        return true; // Indicate change
      } else {
        console.log(`Void types already patched in: ${relativeFilePath}`);
      }
    } else {
      console.log(`No void types found in: ${relativeFilePath}`);
    }
  } catch (error) {
    console.error(`Error patching void types in ${filePath}:`, error);
  }
  return false; // Indicate no change
}

async function addJSDocToFileUpload(filePath) {
  try {
    let content = await fs.readFile(filePath, "utf8");
    const markerIndex = content.indexOf(fetchUploadFileMarker);

    if (markerIndex !== -1) {
      console.log(
        `Found fetchUploadFile function in ${path.relative(process.cwd(), filePath)}`,
      );

      if (content.includes("WORKAROUND: This endpoint requires")) {
        console.log(
          `JSDoc for file upload already exists in ${path.relative(process.cwd(), filePath)}`,
        );
        return false; // No change needed
      }

      // Find the start of the line containing the marker to insert before it
      const lineStartIndex = content.lastIndexOf("\n", markerIndex) + 1;
      const indentation =
        content.substring(lineStartIndex, markerIndex).match(/^ */)?.[0] || "";
      // Indent the JSDoc comment
      const indentedJSDoc =
        fetchUploadFileJSDoc
          .trim()
          .split("\n")
          .map((line) => `${indentation}${line}`)
          .join("\n") + "\n";

      content =
        content.slice(0, lineStartIndex) +
        indentedJSDoc +
        content.slice(lineStartIndex);
      await fs.writeFile(filePath, content, "utf8");
      console.log(
        `Added JSDoc workaround notice to fetchUploadFile in: ${path.relative(process.cwd(), filePath)}`,
      );
      return true; // Indicate change
    } else {
      console.log(
        `fetchUploadFile function not found in ${path.relative(process.cwd(), filePath)}`,
      );
    }
  } catch (error) {
    console.error(`Error adding JSDoc to ${filePath}:`, error);
  }
  return false; // Indicate no change
}

async function fixDeepMerge(filePath) {
  try {
    let content = await fs.readFile(filePath, "utf8");
    const relativeFilePath = path.relative(process.cwd(), filePath);

    if (deepMergeBugPattern.test(content)) {
      console.log(`Found deepMerge bug in: ${relativeFilePath}`);
      const newContent = content.replace(deepMergeBugPattern, deepMergeFix);
      if (newContent !== content) {
        await fs.writeFile(filePath, newContent, "utf8");
        console.log(`Fixed deepMerge bug in: ${relativeFilePath}`);
        return true; // Indicate change
      }
    } else {
      console.log(`No deepMerge bug found in: ${relativeFilePath}`);
    }
  } catch (error) {
    console.error(`Error fixing deepMerge in ${filePath}:`, error);
  }
  return false; // Indicate no change
}

async function run() {
  console.log(`Scanning ${targetDir} for post-processing...`);
  let changesMade = false;
  try {
    const files = await fs.readdir(targetDir);
    const tsFiles = files.filter(
      (file) => file.endsWith(".ts") || file.endsWith(".tsx"),
    );

    if (tsFiles.length === 0) {
      console.log("No TypeScript files found in the target directory.");
      return;
    }

    // Process void types first
    for (const file of tsFiles) {
      const filePath = path.join(targetDir, file);
      if (await patchVoidTypes(filePath)) {
        changesMade = true;
      }
    }

    // Add JSDoc specifically to components file
    if (await addJSDocToFileUpload(componentsFile)) {
      changesMade = true;
    }

    // Fix deepMerge function in utils file
    if (await fixDeepMerge(utilsFile)) {
      changesMade = true;
    }

    if (changesMade) {
      console.log("Post-processing complete.");
    } else {
      console.log("No post-processing changes needed.");
    }
  } catch (error) {
    if (error.code === "ENOENT" && error.path === targetDir) {
      console.warn(
        `Target directory ${targetDir} not found. Skipping post-processing.`,
      );
    } else {
      console.error(
        `Error during post-processing scan of ${targetDir}:`,
        error,
      );
      process.exit(1); // Exit with error code
    }
  }
}

run();
