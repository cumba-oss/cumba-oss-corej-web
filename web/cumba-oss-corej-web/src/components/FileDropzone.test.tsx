import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { FileWithPath } from "@mantine/dropzone";
import { renderWithProviders } from "../test/renderWithProviders";
import { FileDropzone } from "./FileDropzone";

/** Grab the hidden react-dropzone <input type="file"> from the container. */
function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("dropzone file input not found");
  return input;
}

describe("FileDropzone", () => {
  it("renders the instructional copy", () => {
    const { getByText } = renderWithProviders(<FileDropzone onFiles={vi.fn()} />);
    expect(getByText(/Drag study files here/i)).toBeInTheDocument();
  });

  it("invokes onFiles with the selected files", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn<(files: FileWithPath[]) => void>();
    const { container } = renderWithProviders(<FileDropzone onFiles={onFiles} />);

    const a = new File(["a"], "dm.xpt", { type: "application/octet-stream" });
    const b = new File(["b"], "ae.xpt", { type: "application/octet-stream" });
    await user.upload(fileInput(container), [a, b]);

    expect(onFiles).toHaveBeenCalledTimes(1);
    const names = onFiles.mock.calls[0][0].map((f) => f.name);
    expect(names).toEqual(["dm.xpt", "ae.xpt"]);
  });

  it("marks the dropzone disabled when disabled", () => {
    const { getByLabelText } = renderWithProviders(<FileDropzone onFiles={vi.fn()} disabled />);
    expect(getByLabelText("Upload session files")).toHaveAttribute("data-disabled");
  });

  it("does not call onFiles when no files are selected", async () => {
    const user = userEvent.setup();
    const onFiles = vi.fn();
    const { container } = renderWithProviders(
      <FileDropzone onFiles={onFiles} loading disabled={false} />,
    );
    // A click that selects nothing must not fire onFiles.
    await user.click(fileInput(container));
    expect(onFiles).not.toHaveBeenCalled();
  });
});
