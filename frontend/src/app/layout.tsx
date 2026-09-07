// Harness shell.
//
// The provider is deliberately NOT here. Mastra's page puts `<CopilotKit>`
// inside each snippet, pointing at a different `agent` each time -- weatherAgent,
// bgColorAgent, planningAgent -- so each demo route carries its own, exactly as
// published. Hoisting one provider to the layout would mean editing every
// snippet to drop theirs.

import "@copilotkit/react-ui/styles.css";
import "./globals.css";

export const metadata = {
  title: "Mastra · CopilotKit external-docs harness",
  description: "QA harness for mastra.ai/guides/build-your-ui/copilotkit/overview",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
