/**
 * Pagination types and utilities for stateful photons
 *
 * These types define the contract between server (@stateful photons)
 * and client (Beam UI with ViewportAwareProxy) for paginated data.
 *
 * Server returns: { items: T[], _pagination: PaginationMetadata }
 * Client uses ViewportAwareProxy to handle intelligent caching and fetching
 */

/**
 * Metadata describing a page of items in a paginated response
 *
 * The framework automatically generates this when a @stateful method
 * with (start, limit) parameters returns an array.
 */
export interface PaginationMetadata {
  /**
   * Total number of items available across all pages
   * Used by ViewportAwareProxy for cache sizing and progress indicators
   */
  totalCount: number;

  /**
   * Start index of returned items (0-based, inclusive)
   * Example: if start=20, first returned item is at index 20
   */
  start: number;

  /**
   * End index of returned items (0-based, exclusive)
   * Example: if end=40, last returned item is at index 39
   * Always: start ≤ end ≤ totalCount
   */
  end: number;

  /**
   * Whether more items exist after the current end
   * If true: user can scroll/paginate for more data
   * If false: end of dataset reached
   * Invariant: hasMore = (end < totalCount)
   */
  hasMore: boolean;

  /**
   * Optional: Whether items exist before the current start
   * Useful for bi-directional pagination
   * If true: user can scroll up for earlier items
   * Default: false (assume backwards pagination not needed)
   */
  hasMoreBefore?: boolean;
}

/**
 * A paginated response from a @stateful photon method
 *
 * Framework automatically creates this wrapper when:
 * 1. Photon is marked @stateful
 * 2. Method has (start: number, limit: number) parameters
 * 3. Method returns an array T[]
 *
 * The framework detects these conditions and automatically:
 * - Calls GlobalInstanceManager.getFullArray() to get all items
 * - Calculates pagination metadata from the returned subset
 * - Wraps response in this format
 */
export interface PaginatedResponse<T> {
  /**
   * Array of items for this page
   * Length should equal (end - start)
   * Items should be in order by their index
   */
  items: T[];

  /**
   * Pagination metadata (REQUIRED for framework to detect pagination)
   * IMPORTANT: This field name is case-sensitive: _pagination
   * The framework looks for this exact field name
   */
  _pagination: PaginationMetadata;
}

/**
 * A range representing viewport boundaries
 * Used internally by ViewportAwareProxy and ViewportManager
 */
export interface ViewportRange {
  /**
   * Start index of visible items
   */
  start: number;

  /**
   * End index of visible items (exclusive)
   */
  end: number;
}

/**
 * Validates that pagination metadata is consistent
 * Used by framework to catch configuration errors
 *
 * @throws Error if metadata is invalid
 */
export function validatePaginationMetadata(metadata: PaginationMetadata): boolean {
  if (metadata.totalCount < 0) {
    throw new Error(`Invalid totalCount: ${metadata.totalCount} (must be >= 0)`);
  }

  if (metadata.start < 0) {
    throw new Error(`Invalid start: ${metadata.start} (must be >= 0)`);
  }

  if (metadata.end < metadata.start) {
    throw new Error(`Invalid range: end ${metadata.end} < start ${metadata.start}`);
  }

  if (metadata.end > metadata.totalCount) {
    throw new Error(`Invalid end: ${metadata.end} > totalCount ${metadata.totalCount}`);
  }

  // Verify invariant: hasMore = (end < totalCount)
  const expectedHasMore = metadata.end < metadata.totalCount;
  if (metadata.hasMore !== expectedHasMore) {
    console.warn(
      `Pagination metadata inconsistency: hasMore=${metadata.hasMore} but end=${metadata.end} < totalCount=${metadata.totalCount} = ${expectedHasMore}`
    );
  }

  return true;
}

/**
 * Checks if a response contains paginated data
 *
 * @param response Any response from a photon method
 * @returns true if response has _pagination metadata
 */
export function isPaginatedResponse(response: any): response is PaginatedResponse<any> {
  return (
    response &&
    typeof response === 'object' &&
    Array.isArray(response.items) &&
    response._pagination &&
    typeof response._pagination === 'object' &&
    typeof response._pagination.totalCount === 'number' &&
    typeof response._pagination.start === 'number' &&
    typeof response._pagination.end === 'number' &&
    typeof response._pagination.hasMore === 'boolean'
  );
}

/**
 * Calculates buffer range for intelligent prefetching
 *
 * When viewport shows items [start, end], prefetch with buffer:
 * [start - buffer, end + buffer]
 *
 * @param range Visible viewport range
 * @param buffer Number of items to prefetch beyond viewport
 * @param totalCount Total items available (for clamping)
 * @returns Buffered range for fetching
 */
export function calculateBufferedRange(
  range: ViewportRange,
  buffer: number,
  totalCount: number
): ViewportRange {
  return {
    start: Math.max(0, range.start - buffer),
    end: Math.min(totalCount, range.end + buffer),
  };
}

/**
 * Determines if two ranges overlap
 * Used for cache hit detection
 *
 * @param range1 First range
 * @param range2 Second range
 * @returns true if ranges overlap
 */
export function rangesOverlap(range1: ViewportRange, range2: ViewportRange): boolean {
  return !(range1.end <= range2.start || range2.end <= range1.start);
}

/**
 * Calculates device-appropriate page size
 * Used by ViewportManager to determine initial fetch count
 */
export function getPageSizeForDeviceType(deviceType: 'mobile' | 'tablet' | 'desktop'): number {
  switch (deviceType) {
    case 'mobile':
      return 10;
    case 'tablet':
      return 50;
    case 'desktop':
      return 100;
  }
}
