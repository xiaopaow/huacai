import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getListingHistory, restoreListingGeneration } from "../lib/api";
import type { EmployeeAccount, ListingGenerationRecord } from "../types/domain";
import ListingHistoryPage from "./ListingHistoryPage";

vi.mock("../lib/api", () => ({
  getListingHistory: vi.fn(),
  restoreListingGeneration: vi.fn(),
}));

const currentUser: EmployeeAccount = {
  id: "ops-1",
  username: "operator",
  name: "运营甲",
  department: "Amazon 运营",
  role: "运营",
  active: true,
};

const record: ListingGenerationRecord = {
  id: "generation-1",
  listingId: "listing-1",
  version: 2,
  sku: "HC-WALL-001",
  marketplaceName: "美国站",
  productType: "WALL_ART",
  brand: "FLORA",
  generatedById: currentUser.id,
  generatedByName: currentUser.name,
  competitorAsin: "B012345678",
  competitorUrl: "https://www.amazon.com/dp/B012345678",
  model: "openai/gpt-5.4",
  generationMode: "competitor_first",
  title: "FLORA Neutral Canvas Wall Art",
  bulletPoints: ["Point one", "Point two", "Point three", "Point four", "Point five"],
  description: "Description",
  searchTerms: "neutral canvas wall art",
  compliance: { compliant: true, issues: [] },
  generatedAt: "2026-07-13T08:00:00.000Z",
};

describe("ListingHistoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getListingHistory).mockResolvedValue([record]);
    vi.mocked(restoreListingGeneration).mockResolvedValue({} as never);
  });

  it("普通员工看到自己的生成版本、创建人和隐私说明", async () => {
    render(<ListingHistoryPage currentUser={currentUser} notify={vi.fn()} onOpenListing={vi.fn()} />);
    expect(await screen.findByText(record.title)).toBeInTheDocument();
    expect(screen.getByText(/这里只显示你自己生成的 Listing/)).toBeInTheDocument();
    expect(screen.getByText(currentUser.name)).toBeInTheDocument();
    expect(screen.getByText("V2")).toBeInTheDocument();
  });

  it("恢复历史版本后回到对应 Listing", async () => {
    const user = userEvent.setup();
    const onOpenListing = vi.fn();
    render(<ListingHistoryPage currentUser={currentUser} notify={vi.fn()} onOpenListing={onOpenListing} />);
    await screen.findByText(record.title);
    await user.click(screen.getByRole("button", { name: "恢复到草稿" }));
    expect(restoreListingGeneration).toHaveBeenCalledWith(record.id);
    expect(onOpenListing).toHaveBeenCalledWith(record.sku);
  });
});
