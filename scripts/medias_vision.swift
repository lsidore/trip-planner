// Aide de scripts/medias.py : analyse locale des photos avec le framework Vision d'Apple (aucune donnée n'est envoyée).
//
//   medias_vision fichier1.jpg fichier2.jpg …   →  une ligne JSON par fichier :
//   {"f": chemin, "labels": [[nom, confiance], …], "visages": [aire, …], "texte": {"mots": n, "aire": a}}
//
// - labels  : classification de scène (VNClassifyImageRequest, ~1 300 classes : « conference », « bedroom »…),
//             les 16 premières au-dessus de 0,05 ;
// - visages : aire de chaque visage, en fraction de l'image (VNDetectFaceRectanglesRequest) ;
// - texte   : mots, lignes et aire cumulée des zones de texte lues avec assurance (VNRecognizeTextRequest, niveau précis).
// Compilation (faite par medias.py au besoin) : swiftc -O scripts/medias_vision.swift -o <binaire>
import Foundation
import Vision
import ImageIO

func esc(_ s: String) -> String {
    return s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
}

for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let img = CGImageSourceCreateThumbnailAtIndex(src, 0, [
              kCGImageSourceCreateThumbnailFromImageAlways: true,
              kCGImageSourceThumbnailMaxPixelSize: 640,
              kCGImageSourceCreateThumbnailWithTransform: true] as CFDictionary) else {
        print("{\"f\":\"\(esc(path))\",\"erreur\":\"lecture\"}")
        continue
    }
    let classify = VNClassifyImageRequest()
    let faces = VNDetectFaceRectanglesRequest()
    let text = VNRecognizeTextRequest()
    // niveau précis : le niveau rapide rend toujours la confiance 0,5 et lit mal les affiches (vérifié le 2026-10-28)
    text.recognitionLevel = .accurate
    text.usesLanguageCorrection = true
    let handler = VNImageRequestHandler(cgImage: img, options: [:])
    do { try handler.perform([classify, faces, text]) } catch {
        print("{\"f\":\"\(esc(path))\",\"erreur\":\"vision\"}")
        continue
    }
    let labels = (classify.results ?? []).filter { $0.confidence > 0.05 }.prefix(16)
        .map { "[\"\(esc($0.identifier))\",\(String(format: "%.3f", $0.confidence))]" }.joined(separator: ",")
    let fa = (faces.results ?? []).map { String(format: "%.4f", $0.boundingBox.width * $0.boundingBox.height) }.joined(separator: ",")
    var mots = 0
    var aire = 0.0
    var lignes = 0
    for o in text.results ?? [] {
        // seules les lignes lues avec assurance (≥ 0,6) et d'au moins 3 caractères comptent : le feuillage et les motifs
        // donnent des « lignes » de faible confiance, ou d'un ou deux caractères, qui ne sont pas du texte
        if let best = o.topCandidates(1).first, best.confidence >= 0.6, best.string.count >= 3 {
            mots += best.string.split(separator: " ").count
            aire += Double(o.boundingBox.width * o.boundingBox.height)
            lignes += 1
        }
    }
    print("{\"f\":\"\(esc(path))\",\"labels\":[\(labels)],\"visages\":[\(fa)],\"texte\":{\"mots\":\(mots),\"aire\":\(String(format: "%.4f", aire)),\"lignes\":\(lignes)}}")
}
