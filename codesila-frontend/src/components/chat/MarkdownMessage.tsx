import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = { content: string };

export default function MarkdownMessage({ content }: Props) {
  return (
    <div className="prose prose-invert prose-sm max-w-none 
      prose-headings:text-cyber-cyan prose-headings:font-orbitron prose-headings:mt-3 prose-headings:mb-1
      prose-p:my-1 prose-p:leading-relaxed
      prose-ul:my-1 prose-ol:my-1 prose-li:my-0
      prose-strong:text-cyber-cyan/90
      prose-code:text-cyber-green prose-code:bg-black/40 prose-code:px-1 prose-code:rounded prose-code:text-xs
      prose-pre:bg-black/50 prose-pre:border prose-pre:border-cyber-cyan/10 prose-pre:rounded-lg prose-pre:text-xs
      prose-a:text-cyber-cyan prose-a:underline prose-a:underline-offset-2
      prose-table:text-xs prose-th:text-cyber-cyan/80 prose-td:border-cyber-cyan/10
      text-[13px] leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
