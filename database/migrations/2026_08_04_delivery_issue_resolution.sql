-- Admin's resolution note (and who resolved it) for a delivery issue.
ALTER TABLE delivery_issue
  ADD COLUMN resolutionNote VARCHAR(500) NULL AFTER issueStatus,
  ADD COLUMN resolvedBy     VARCHAR(10)  NULL AFTER resolutionNote;
