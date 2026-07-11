export default function PdfView({ url }: { url: string }) {
  return (
    <div className="h-full w-full bg-gray-100">
      <iframe title="pdf-preview" src={url} className="w-full h-full border-0" />
    </div>
  );
}
